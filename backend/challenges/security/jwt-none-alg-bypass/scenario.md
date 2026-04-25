# Scenario

An API gateway accepts bearer tokens for privileged routes. During review, a teammate noticed token parsing logic that may honor attacker-controlled header values.

## Goal

Determine whether JWT verification can be bypassed and outline a hardened validation policy.
