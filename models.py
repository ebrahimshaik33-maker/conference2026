from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin

db = SQLAlchemy()


class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    role = db.Column(db.String(20), default='admin')
    created_at = db.Column(db.DateTime, default=datetime.now)

    audit_logs = db.relationship('AuditLog', backref='user', lazy='dynamic')

    def __repr__(self):
        return f'<User {self.username}>'


class Session(db.Model):
    __tablename__ = 'sessions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    day = db.Column(db.Integer, nullable=False)
    start_time = db.Column(db.String(5), nullable=False)
    end_time = db.Column(db.String(5), nullable=True)
    title = db.Column(db.String(300), nullable=False)
    presenter = db.Column(db.String(200), nullable=True)
    affiliation = db.Column(db.String(200), nullable=True)
    bio = db.Column(db.Text, nullable=True)
    location = db.Column(db.String(100), nullable=True)
    track = db.Column(db.String(100), nullable=True)
    type = db.Column(db.String(20), nullable=False, default='session')
    paper_url = db.Column(db.String(500), nullable=True)
    evaluation_url = db.Column(db.String(500), nullable=True)
    description = db.Column(db.Text, nullable=True)
    menu_details = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='')
    moved_to = db.Column(db.String(200), nullable=True)
    display_order = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.now)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    __table_args__ = (
        db.Index('idx_sessions_day', 'day'),
        db.Index('idx_sessions_day_time', 'day', 'start_time', 'display_order'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'day': self.day,
            'start_time': self.start_time,
            'end_time': self.end_time,
            'title': self.title,
            'presenter': self.presenter,
            'affiliation': self.affiliation,
            'bio': self.bio,
            'location': self.location,
            'track': self.track,
            'type': self.type,
            'paper_url': self.paper_url,
            'evaluation_url': self.evaluation_url,
            'description': self.description,
            'menu_details': self.menu_details,
            'status': self.status,
            'moved_to': self.moved_to,
            'display_order': self.display_order,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f'<Session {self.id}: {self.title}>'


class Setting(db.Model):
    __tablename__ = 'settings'

    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.now, onupdate=datetime.now)

    def __repr__(self):
        return f'<Setting {self.key}={self.value}>'


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(100), nullable=False)
    detail = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.now)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'username': self.user.username if self.user else 'system',
            'action': self.action,
            'detail': self.detail,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }

    def __repr__(self):
        return f'<AuditLog {self.action} by user {self.user_id}>'


class PushSubscription(db.Model):
    __tablename__ = 'push_subscriptions'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    endpoint = db.Column(db.Text, nullable=False, unique=True)
    p256dh = db.Column(db.Text, nullable=False)
    auth = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)

    def to_dict(self):
        return {
            'id': self.id,
            'endpoint': self.endpoint,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<PushSubscription {self.id}>'
