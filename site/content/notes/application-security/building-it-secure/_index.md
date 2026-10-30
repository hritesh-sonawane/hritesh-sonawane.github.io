+++
title = 'Building it secure'
description = 'The earlier modules found vulnerabilities one class at a time. This module is about the engineering habits that stop them recurring: secure defaults, adversarial tests, a controlled dependency supply, and security-focused code review.'
weight = 5
+++

Every lesson so far has ended the same way: a specific mistake, a specific fix.
Fixes one at a time do not scale. A team that ships every week will reintroduce
injection, missing authorization checks and unsafe file handling unless the way
it builds software makes those mistakes hard to write, quick to detect, and
visible in review. This module is about that machinery.

The four lessons cover frameworks and platforms whose defaults catch the
mistake before it ships, tests written by someone trying to break the code,
the third-party code that makes up most of what you deploy, and code review
that follows data from where it enters to where it can do harm. By the end you
should be able to look at a team's toolchain and say **which classes of bug it
prevents by construction, which it detects, and which still depend on someone
remembering**.
