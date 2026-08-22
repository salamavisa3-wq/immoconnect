# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

# Installer les dépendances
COPY dashboard/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copier le dashboard
COPY dashboard/ ./

EXPOSE 10000

CMD ["gunicorn", "-b", "0.0.0.0:10000", "wsgi:application"]
