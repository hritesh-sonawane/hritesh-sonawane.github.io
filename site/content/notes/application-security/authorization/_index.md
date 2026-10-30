+++
title = 'Authorization'
description = 'Authentication says who is calling; authorization decides what they may do to this object, in this tenant, right now. This module covers object-level checks, access-control models, tenant isolation, and centralized policy.'
weight = 3
+++

Most API breaches do not involve breaking authentication. The attacker logs in
as themselves, quite legitimately, and then asks for something that belongs to
someone else. The server checks that the caller is *somebody* and never asks
whether this caller may touch *this* record. Authorization is the decision that
runs on every request, for every object, and it is the one most often missing.

The four lessons move outward from a single handler. They start with the
object-level check and the negative tests that prove it exists, compare the
models used to express permissions (roles, attributes, relationships), extend
the boundary to whole tenants sharing one system, and end with moving the
decision into a policy engine that can be reviewed, tested, and logged. By the
end you should be able to look at an endpoint and say **which check stops a
second, ordinary user from reaching the first user's data, and where that check
is tested**.
