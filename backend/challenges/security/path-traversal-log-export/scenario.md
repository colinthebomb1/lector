# Scenario

Operations staff can export server logs by supplying a file name. Security suspects path normalization is incomplete and allows reading arbitrary files.

## Goal

Confirm the traversal condition and define a canonicalization + allow-list based fix.
