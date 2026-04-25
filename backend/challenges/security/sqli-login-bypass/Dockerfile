FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir flask pytest requests

COPY code/app.py /app/app.py
COPY tests/ /app/tests/

RUN python -c "import app; app.init_db()"

EXPOSE 5000

CMD ["python", "app.py"]
