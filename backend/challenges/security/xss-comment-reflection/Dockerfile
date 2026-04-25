FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir flask pytest requests

COPY code/ /app/
COPY tests/ /app/tests/
COPY secret/ /app/secret/

EXPOSE 5000

# Inject per-session flag from LECTOR_FLAG env var (set by attack_session.py).
# Falls back to the file shipped in the image when used by the grader.
CMD ["sh", "-c", "if [ -n \"$LECTOR_FLAG\" ]; then printf '%s\\n' \"$LECTOR_FLAG\" > /app/secret/flag.txt; fi && python app.py"]
