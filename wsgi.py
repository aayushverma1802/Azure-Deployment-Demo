from app import app

try:
    from a2wsgi import ASGIMiddleware
    application = ASGIMiddleware(app)
    wsgi_app = application
except Exception:
    application = app
    wsgi_app = app
