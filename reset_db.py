"""
Database Reset & Fresh Seed Script
Run this script to flush the database and initialize clean, generic demo data:
    venv\\Scripts\\python reset_db.py
"""

import os
import sys
from datetime import datetime
from bcrypt import hashpw, gensalt

from app import create_app
from models import db, User, Setting, Session, AuditLog, PushSubscription

def reset_and_seed():
    app = create_app()
    with app.app_context():
        print("[RESET] Resetting database...")
        # Drop all tables and recreate
        db.drop_all()
        db.create_all()

        print("[ADMIN] Creating default admin user...")
        admin_password = "admin123"
        hashed = hashpw(admin_password.encode('utf-8'), gensalt()).decode('utf-8')
        admin = User(username='admin', password_hash=hashed, role='admin')
        db.session.add(admin)

        print("[SETTINGS] Initializing clean default settings...")
        default_settings = [
            Setting(key='event_title', value='Annual Innovation & Education Summit 2026'),
            Setting(key='event_subtitle', value='Advancing Learning, Technology & Research'),
            Setting(key='event_description', value='Welcome to the Annual Summit. Explore keynote presentations, technical sessions, and networking events.'),
            Setting(key='event_start_date', value='2026-09-15'),
            Setting(key='event_days', value='3'),
            Setting(key='theme', value='theme-adv-dark'),
            Setting(key='layout', value='timeline'),
            Setting(key='ui_style', value='glass'),
            Setting(key='show_track_filter', value='true'),
            Setting(key='show_evaluation_links', value='true'),
            Setting(key='push_enabled', value='true'),
            Setting(key='announcement', value='Welcome to the Annual Innovation & Education Summit! Check the programme below.'),
            Setting(key='announcement_type', value='info'),
            Setting(key='footer_text', value='© 2026 Annual Summit. Digital Programme & Event Portal.'),
            Setting(key='logo_path', value=''),
            Setting(key='banner_path', value=''),
            Setting(key='brand_title_color', value=''),
            Setting(key='brand_heading_font', value=''),
            Setting(key='brand_body_font', value=''),
            Setting(key='google_analytics_id', value=''),
        ]
        db.session.add_all(default_settings)

        print("[SESSIONS] Seeding fresh demo schedule sessions...")
        demo_sessions = [
            # Day 1
            Session(
                day=1, type='general', start_time='08:00', end_time='09:00',
                title='Registration & Welcome Coffee', presenter='', affiliation='',
                location='Main Foyer', track='Administration',
                description='Collect your conference badge and programme booklet from the registration desk in the main foyer.',
                paper_url='', evaluation_url='', status='active', display_order=1
            ),
            Session(
                day=1, type='keynote', start_time='09:00', end_time='10:00',
                title='Opening Keynote: Transforming Higher Education for the Next Decade',
                presenter='Prof. Sandra Nkosi', affiliation='Global Tech University',
                location='Main Hall', track='Plenary',
                description='Professor Nkosi delivers the opening address exploring how emerging technologies are fundamentally reshaping the learning landscape in modern universities.',
                paper_url='', evaluation_url='', status='active', display_order=2
            ),
            Session(
                day=1, type='break', start_time='10:00', end_time='10:30',
                title='Morning Tea & Networking', presenter='', affiliation='',
                location='Exhibition Foyer', track='Administration',
                description='Light refreshments served in the exhibition foyer. Poster presentations open.',
                paper_url='', evaluation_url='', status='active', display_order=3
            ),
            Session(
                day=1, type='session', start_time='10:30', end_time='11:15',
                title='Designing for Inclusion: Universal Design for Learning Frameworks',
                presenter='Dr. Ayesha Pillay', affiliation='Institute of Science & Technology',
                location='Room 1A', track='Learning & Teaching',
                description='This session presents practical frameworks and student feedback data from a multi-facility implementation of Universal Design for Learning (UDL).',
                paper_url='', evaluation_url='/eval/101', status='active', display_order=4
            ),
            Session(
                day=1, type='session', start_time='10:30', end_time='11:15',
                title='AI-Assisted Feedback in Technical Courses: A Pilot Study',
                presenter='Mr. Thabo Dlamini', affiliation='National Research University',
                location='Room 2B', track='Technology & Innovation',
                description='A report on using AI-based assistant tools to provide instant formative feedback to students. Results show noticeable improvement in assignment scores.',
                paper_url='', evaluation_url='', status='active', display_order=5
            ),
            Session(
                day=1, type='session', start_time='11:30', end_time='12:15',
                title='Flipped Classroom Evidence: What Does the Data Show?',
                presenter='Prof. James van der Berg', affiliation='International College',
                location='Room 1A', track='Learning & Teaching',
                description='A meta-analysis of flipped classroom studies across higher education institutions. The presenter reviews popular assumptions against empirical data.',
                paper_url='', evaluation_url='', status='active', display_order=6
            ),
            Session(
                day=1, type='break', start_time='12:30', end_time='13:30',
                title='Networking Lunch & Exhibition', presenter='', affiliation='',
                location='Dining Hall', track='Administration',
                description='Buffet lunch served for all registered attendees. Visit vendor booths in the main hall.',
                paper_url='', evaluation_url='', status='active', display_order=7
            ),
            Session(
                day=1, type='panel', start_time='13:30', end_time='14:30',
                title='Panel Discussion: Digital Transformation in Academic Research',
                presenter='Panel Members', affiliation='Global Research Consortium',
                location='Main Hall', track='Plenary',
                description='Leading scholars discuss key opportunities and challenges in adopting open data, digital repositories, and collaborative tools.',
                paper_url='', evaluation_url='', status='active', display_order=8
            ),

            # Day 2
            Session(
                day=2, type='keynote', start_time='09:00', end_time='10:00',
                title='Day 2 Keynote: Ethical Considerations in Educational Technology',
                presenter='Dr. Michael Chen', affiliation='Cybernetics Institute',
                location='Main Hall', track='Plenary',
                description='Exploring governance, data privacy, and ethical guidelines when implementing automated technologies in educational systems.',
                paper_url='', evaluation_url='', status='active', display_order=1
            ),
            Session(
                day=2, type='workshop', start_time='10:30', end_time='11:30',
                title='Interactive Workshop: Building Blended Learning Environments',
                presenter='Ms. Sarah Adams', affiliation='Educational Technology Academy',
                location='Room 2A', track='Technology & Innovation',
                description='A hands-on workshop covering curriculum mapping, hybrid delivery models, and active learning strategies.',
                paper_url='', evaluation_url='', status='active', display_order=2
            ),

            # Day 3
            Session(
                day=3, type='keynote', start_time='09:00', end_time='10:00',
                title='Day 3 Keynote: Global Trends in Academic Leadership & Engagement',
                presenter='Prof. David Evans', affiliation='Global Education Center',
                location='Main Hall', track='Plenary',
                description='Strategies for fostering interdisciplinary collaboration, community engagement, and institutional growth.',
                paper_url='', evaluation_url='', status='active', display_order=1
            ),
            Session(
                day=3, type='general', start_time='11:00', end_time='12:00',
                title='Closing Ceremony & Best Presentation Awards',
                presenter='Conference Organising Committee', affiliation='',
                location='Main Hall', track='Administration',
                description='Official closing remarks, presentation of best paper & poster awards, and announcement of the 2027 summit venue.',
                paper_url='', evaluation_url='', status='active', display_order=2
            ),
        ]
        db.session.add_all(demo_sessions)

        # Log reset action in AuditLog
        log_entry = AuditLog(
            action='RESET_DATABASE',
            user_id=admin.id,
            detail='Database flushed and populated with clean demo data.'
        )
        db.session.add(log_entry)

        db.session.commit()
        print("[SUCCESS] Database successfully flushed and seeded with clean demo data!")
        print("[CREDENTIALS] Admin Login -> Username: admin | Password: admin123")

if __name__ == "__main__":
    reset_and_seed()
