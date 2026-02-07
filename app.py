import os
from flask import Flask, render_template, request, redirect, url_for, session, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'super-bowl-with-seth-dev-key-2026')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///superbowl.db')
# Fix for Render PostgreSQL URL format
if app.config['SQLALCHEMY_DATABASE_URI'].startswith('postgres://'):
    app.config['SQLALCHEMY_DATABASE_URI'] = app.config['SQLALCHEMY_DATABASE_URI'].replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Admin password - set via environment variable in production
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'seth2026')

# ============== MODELS ==============

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    game_started = db.Column(db.Boolean, default=False)
    submissions_locked = db.Column(db.Boolean, default=False)

class Prop(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    question = db.Column(db.String(500), nullable=False)
    note = db.Column(db.String(300), nullable=True)
    order = db.Column(db.Integer, default=0)
    resolved = db.Column(db.Boolean, default=False)
    correct_answer_id = db.Column(db.Integer, db.ForeignKey('answer.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    answers = db.relationship('Answer', backref='prop', lazy=True, foreign_keys='Answer.prop_id')

class Answer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    prop_id = db.Column(db.Integer, db.ForeignKey('prop.id'), nullable=False)
    text = db.Column(db.String(200), nullable=False)
    points = db.Column(db.Integer, default=1)
    order = db.Column(db.Integer, default=0)

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    picks = db.relationship('Pick', backref='entry', lazy=True)

class Pick(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('entry.id'), nullable=False)
    prop_id = db.Column(db.Integer, db.ForeignKey('prop.id'), nullable=False)
    answer_id = db.Column(db.Integer, db.ForeignKey('answer.id'), nullable=False)
    
    prop = db.relationship('Prop', backref='picks')
    answer = db.relationship('Answer')

# ============== HELPERS ==============

def get_settings():
    settings = Settings.query.first()
    if not settings:
        settings = Settings()
        db.session.add(settings)
        db.session.commit()
    return settings

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('is_admin'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function

def calculate_score(entry):
    """Calculate total score for an entry based on resolved props"""
    total = 0
    for pick in entry.picks:
        if pick.prop.resolved and pick.prop.correct_answer_id == pick.answer_id:
            total += pick.answer.points
    return total

def get_pick_status(pick):
    """Returns 'correct', 'incorrect', or 'pending' for a pick"""
    if not pick.prop.resolved:
        return 'pending'
    if pick.prop.correct_answer_id == pick.answer_id:
        return 'correct'
    return 'incorrect'

# ============== PUBLIC ROUTES ==============

@app.route('/')
def index():
    settings = get_settings()
    props_count = Prop.query.count()
    entries_count = Entry.query.count()
    return render_template('index.html', 
                         settings=settings, 
                         props_count=props_count,
                         entries_count=entries_count)

@app.route('/prop-sheet', methods=['GET', 'POST'])
def prop_sheet():
    settings = get_settings()
    
    if settings.submissions_locked:
        flash('Submissions are now closed!', 'error')
        return redirect(url_for('index'))
    
    props = Prop.query.order_by(Prop.order, Prop.id).all()
    
    if request.method == 'POST':
        name = request.form.get('name', '').strip()
        
        if not name:
            flash('Please enter your name!', 'error')
            return render_template('prop_sheet.html', props=props, settings=settings)
        
        # Check if name already exists
        existing = Entry.query.filter(db.func.lower(Entry.name) == name.lower()).first()
        if existing:
            flash(f'An entry for "{name}" already exists! Choose a different name or contact Seth.', 'error')
            return render_template('prop_sheet.html', props=props, settings=settings)
        
        # Create entry
        entry = Entry(name=name)
        db.session.add(entry)
        db.session.flush()  # Get the entry ID
        
        # Save all picks
        for prop in props:
            answer_id = request.form.get(f'prop_{prop.id}')
            if answer_id:
                pick = Pick(entry_id=entry.id, prop_id=prop.id, answer_id=int(answer_id))
                db.session.add(pick)
        
        db.session.commit()
        flash(f'Thanks {name}! Your picks have been submitted!', 'success')
        return redirect(url_for('submit_success', entry_id=entry.id))
    
    return render_template('prop_sheet.html', props=props, settings=settings)

@app.route('/submit-success/<int:entry_id>')
def submit_success(entry_id):
    entry = Entry.query.get_or_404(entry_id)
    return render_template('submit_success.html', entry=entry)

@app.route('/entries')
def entries():
    settings = get_settings()
    entries_list = Entry.query.order_by(Entry.name).all()
    
    # Calculate scores for each entry
    entries_with_scores = []
    for entry in entries_list:
        score = calculate_score(entry)
        entries_with_scores.append({'entry': entry, 'score': score})
    
    return render_template('entries.html', 
                         entries=entries_with_scores, 
                         settings=settings)

@app.route('/entry/<int:entry_id>')
def entry_detail(entry_id):
    settings = get_settings()
    entry = Entry.query.get_or_404(entry_id)
    props = Prop.query.order_by(Prop.order, Prop.id).all()
    
    # Build picks dictionary
    picks_dict = {pick.prop_id: pick for pick in entry.picks}
    
    # Calculate score
    score = calculate_score(entry)
    
    return render_template('entry_detail.html', 
                         entry=entry, 
                         props=props, 
                         picks_dict=picks_dict,
                         score=score,
                         settings=settings,
                         get_pick_status=get_pick_status)

@app.route('/standings')
def standings():
    settings = get_settings()
    entries_list = Entry.query.all()
    
    # Calculate scores and build standings
    standings_data = []
    for entry in entries_list:
        score = calculate_score(entry)
        correct_picks = sum(1 for pick in entry.picks 
                          if pick.prop.resolved and pick.prop.correct_answer_id == pick.answer_id)
        total_resolved = Prop.query.filter_by(resolved=True).count()
        standings_data.append({
            'entry': entry,
            'score': score,
            'correct_picks': correct_picks,
            'total_resolved': total_resolved
        })
    
    # Sort by score descending
    standings_data.sort(key=lambda x: x['score'], reverse=True)
    
    # Add rank
    for i, data in enumerate(standings_data):
        data['rank'] = i + 1
    
    total_props = Prop.query.count()
    resolved_props = Prop.query.filter_by(resolved=True).count()
    
    return render_template('standings.html', 
                         standings=standings_data, 
                         settings=settings,
                         total_props=total_props,
                         resolved_props=resolved_props)

# ============== ADMIN ROUTES ==============

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        password = request.form.get('password', '')
        if password == ADMIN_PASSWORD:
            session['is_admin'] = True
            flash('Welcome, Seth!', 'success')
            return redirect(url_for('admin_dashboard'))
        else:
            flash('Wrong password!', 'error')
    return render_template('admin_login.html')

@app.route('/admin/logout')
def admin_logout():
    session.pop('is_admin', None)
    flash('Logged out!', 'success')
    return redirect(url_for('index'))

@app.route('/admin')
@admin_required
def admin_dashboard():
    settings = get_settings()
    props_count = Prop.query.count()
    entries_count = Entry.query.count()
    resolved_count = Prop.query.filter_by(resolved=True).count()
    return render_template('admin_dashboard.html', 
                         settings=settings,
                         props_count=props_count,
                         entries_count=entries_count,
                         resolved_count=resolved_count)

@app.route('/admin/settings', methods=['POST'])
@admin_required
def admin_settings():
    settings = get_settings()
    action = request.form.get('action')
    
    if action == 'start_game':
        settings.game_started = True
        settings.submissions_locked = True
        flash('Game started! Picks are now visible to everyone.', 'success')
    elif action == 'stop_game':
        settings.game_started = False
        flash('Game stopped. Picks are hidden again.', 'success')
    elif action == 'lock_submissions':
        settings.submissions_locked = True
        flash('Submissions locked!', 'success')
    elif action == 'unlock_submissions':
        settings.submissions_locked = False
        flash('Submissions unlocked!', 'success')
    
    db.session.commit()
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/props')
@admin_required
def admin_props():
    props = Prop.query.order_by(Prop.order, Prop.id).all()
    return render_template('admin_props.html', props=props)

@app.route('/admin/props/add', methods=['GET', 'POST'])
@admin_required
def admin_add_prop():
    if request.method == 'POST':
        question = request.form.get('question', '').strip()
        note = request.form.get('note', '').strip() or None
        
        if not question:
            flash('Question is required!', 'error')
            return redirect(url_for('admin_add_prop'))
        
        # Get max order
        max_order = db.session.query(db.func.max(Prop.order)).scalar() or 0
        
        prop = Prop(question=question, note=note, order=max_order + 1)
        db.session.add(prop)
        db.session.flush()
        
        # Add answers
        answer_texts = request.form.getlist('answer_text[]')
        answer_points = request.form.getlist('answer_points[]')
        
        for i, (text, points) in enumerate(zip(answer_texts, answer_points)):
            if text.strip():
                answer = Answer(
                    prop_id=prop.id,
                    text=text.strip(),
                    points=int(points) if points else 1,
                    order=i
                )
                db.session.add(answer)
        
        db.session.commit()
        flash('Prop added!', 'success')
        return redirect(url_for('admin_props'))
    
    return render_template('admin_add_prop.html')

@app.route('/admin/props/<int:prop_id>/edit', methods=['GET', 'POST'])
@admin_required
def admin_edit_prop(prop_id):
    prop = Prop.query.get_or_404(prop_id)
    
    if request.method == 'POST':
        prop.question = request.form.get('question', '').strip()
        prop.note = request.form.get('note', '').strip() or None
        
        # Delete existing answers
        Answer.query.filter_by(prop_id=prop.id).delete()
        
        # Add new answers
        answer_texts = request.form.getlist('answer_text[]')
        answer_points = request.form.getlist('answer_points[]')
        
        for i, (text, points) in enumerate(zip(answer_texts, answer_points)):
            if text.strip():
                answer = Answer(
                    prop_id=prop.id,
                    text=text.strip(),
                    points=int(points) if points else 1,
                    order=i
                )
                db.session.add(answer)
        
        db.session.commit()
        flash('Prop updated!', 'success')
        return redirect(url_for('admin_props'))
    
    return render_template('admin_edit_prop.html', prop=prop)

@app.route('/admin/props/<int:prop_id>/delete', methods=['POST'])
@admin_required
def admin_delete_prop(prop_id):
    prop = Prop.query.get_or_404(prop_id)
    
    # Delete associated picks first
    Pick.query.filter_by(prop_id=prop.id).delete()
    # Delete answers
    Answer.query.filter_by(prop_id=prop.id).delete()
    # Delete prop
    db.session.delete(prop)
    db.session.commit()
    
    flash('Prop deleted!', 'success')
    return redirect(url_for('admin_props'))

@app.route('/admin/props/<int:prop_id>/move/<direction>', methods=['POST'])
@admin_required
def admin_move_prop(prop_id, direction):
    prop = Prop.query.get_or_404(prop_id)
    props = Prop.query.order_by(Prop.order, Prop.id).all()
    
    # Find current index
    current_index = next((i for i, p in enumerate(props) if p.id == prop_id), None)
    
    if current_index is None:
        flash('Prop not found!', 'error')
        return redirect(url_for('admin_props'))
    
    if direction == 'up' and current_index > 0:
        # Swap with previous prop
        other_prop = props[current_index - 1]
        prop.order, other_prop.order = other_prop.order, prop.order
        # If they have the same order value, adjust
        if prop.order == other_prop.order:
            prop.order -= 1
        db.session.commit()
    elif direction == 'down' and current_index < len(props) - 1:
        # Swap with next prop
        other_prop = props[current_index + 1]
        prop.order, other_prop.order = other_prop.order, prop.order
        # If they have the same order value, adjust
        if prop.order == other_prop.order:
            prop.order += 1
        db.session.commit()
    
    return redirect(url_for('admin_props'))

@app.route('/admin/answers')
@admin_required
def admin_answers():
    props = Prop.query.order_by(Prop.order, Prop.id).all()
    return render_template('admin_answers.html', props=props)

@app.route('/admin/props/<int:prop_id>/resolve', methods=['POST'])
@admin_required
def admin_resolve_prop(prop_id):
    prop = Prop.query.get_or_404(prop_id)
    answer_id = request.form.get('answer_id')
    
    if answer_id:
        prop.correct_answer_id = int(answer_id)
        prop.resolved = True
        flash(f'Marked correct answer for: {prop.question[:50]}...', 'success')
    else:
        prop.correct_answer_id = None
        prop.resolved = False
        flash(f'Unresolved: {prop.question[:50]}...', 'success')
    
    db.session.commit()
    return redirect(url_for('admin_answers'))

@app.route('/admin/entries')
@admin_required
def admin_entries():
    entries_list = Entry.query.order_by(Entry.name).all()
    return render_template('admin_entries.html', entries=entries_list)

@app.route('/admin/entries/<int:entry_id>/delete', methods=['POST'])
@admin_required
def admin_delete_entry(entry_id):
    entry = Entry.query.get_or_404(entry_id)
    
    # Delete picks first
    Pick.query.filter_by(entry_id=entry.id).delete()
    # Delete entry
    db.session.delete(entry)
    db.session.commit()
    
    flash(f'Deleted entry for {entry.name}', 'success')
    return redirect(url_for('admin_entries'))

# ============== API ROUTES (for live updates) ==============

@app.route('/api/standings')
def api_standings():
    settings = get_settings()
    if not settings.game_started:
        return jsonify({'error': 'Game not started'}), 403
    
    entries_list = Entry.query.all()
    standings_data = []
    
    for entry in entries_list:
        score = calculate_score(entry)
        standings_data.append({
            'name': entry.name,
            'score': score,
            'id': entry.id
        })
    
    standings_data.sort(key=lambda x: x['score'], reverse=True)
    
    resolved_count = Prop.query.filter_by(resolved=True).count()
    total_count = Prop.query.count()
    
    return jsonify({
        'standings': standings_data,
        'resolved': resolved_count,
        'total': total_count
    })

# ============== INIT ==============

with app.app_context():
    db.create_all()
    # Ensure settings exist
    get_settings()

if __name__ == '__main__':
    app.run(debug=True)
