# Loaded automatically by gunicorn from the working directory.
# Career Agent answers make two live model calls, which can exceed gunicorn's 30s default.
worker_class = "gthread"
workers = 2
threads = 4
timeout = 180
