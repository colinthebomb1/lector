FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir flask pytest requests

COPY code/ /app/
COPY tests/ /app/tests/
COPY secret/ /secrets/super-secret/

EXPOSE 5000

# At container start, if LECTOR_FLAG is provided (attack-session mode),
# overwrite the on-disk flag so each session has a unique value.
# Otherwise fall back to the file shipped in the image (used by the grader).
CMD ["sh", "-c", "if [ -n \"$LECTOR_FLAG\" ]; then printf '%s\\n' \"$LECTOR_FLAG\" > /secrets/super-secret/flag.txt; fi && python app.py"]
