+++
title = 'Delivery and operations'
description = 'How a workload gets from a commit to a cluster without anyone swapping it on the way, and what to do when an identity is used by someone it should not be.'
weight = 5
+++

The earlier modules make a running workload hard to abuse. This one covers the
two places where that work is most often undone: the delivery pipeline that
builds and ships the workload, and the operations that notice when something
has gone wrong anyway. A CI system holds more authority than most production
services, and a stolen session credential can mint new ones faster than a
responder reads the alert.

The four lessons follow an artifact and then an incident: treating CI as a
privileged system and proving where a build came from, signing images and
enforcing identity at admission, collecting audit logs and writing detections
that people act on, and scoping and containing a compromised cloud identity.
By the end of it you should be able to say **which build produced the code that
is running, who was allowed to sign it, and, when a credential leaks, exactly
which sessions and resources to cut off first**.
