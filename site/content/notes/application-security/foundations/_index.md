+++
title = 'Foundations'
description = 'Where trust is decided in an application, how to find what can go wrong before writing code, and the handful of root causes behind the long vulnerability lists.'
weight = 1
+++

Every request that reaches your application was written by someone you do not
control. This module starts there: what in a request can be believed, what has
to be looked up, and why the server, not the client, owns every security
decision. It then turns that idea into a method, threat modeling an API one
element and one endpoint at a time, and finishes with the vulnerability lists
the industry uses (OWASP Top 10, OWASP API Security Top 10, CWE) read as maps of
a few underlying mistakes.

By the end of it you should be able to point at any line of a handler and say
**which value it trusts, who could have written that value, and which of four
root causes a bug there would belong to**. The rest of the course takes each
root cause in turn.
