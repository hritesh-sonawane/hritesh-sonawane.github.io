+++
title = 'Authentication'
description = 'How an application decides who is making a request: stored credentials, sessions, delegated sign-in, tokens, and the second factors that resist phishing.'
weight = 2
+++

Authentication turns a claim ("I am alice") into something the application can
rely on for the rest of a session. Each step of that process has its own
failure: a password database that cracks in an afternoon, a session cookie that
an attacker chose, an authorization code redeemed by the wrong app, a token
verifier that trusts the token's own header, a one-time code typed into a
phishing page. The five lessons take those steps in order, from storing a
password to replacing it with a passkey.

By the end of the module you should be able to review a sign-in flow and say
**which secret proves identity at each hop, where an attacker could capture or
replay it, and which check, made by the server and not the client, stops
them**. Every lesson includes a small simulated attack and the fix, in Python
you can run.
