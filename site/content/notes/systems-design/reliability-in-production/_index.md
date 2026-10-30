+++
title = 'Reliability in production'
description = 'How to state reliability as a number, see what a running system is doing, change it without breaking it, and get the data back when something destroys it.'
weight = 4
+++

The earlier modules designed systems that keep their promises under overlap,
failure, and load. This module is about keeping those promises **after
launch**, when the system changes every day, the traffic is real, and the
people operating it need to know whether to wake up. It starts by turning
"reliable" into a measured objective with a budget, then covers the telemetry
that tells you how close you are to it, the release practices that stop most
outages before they reach users, and the backups and failover plans that limit
the damage when everything else has failed.

By the end of it you should be able to write an SLO and the alerts that defend
it, read a latency histogram without being fooled by it, design a rollout that
catches a bad change on a few percent of traffic, and state, for a given
dataset, **how much you would lose and how long you would be down** after a
deletion, a ransomware attack, or a lost region.
