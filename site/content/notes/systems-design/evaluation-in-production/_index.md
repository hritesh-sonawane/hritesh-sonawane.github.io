+++
title = 'Evaluation in production'
description = 'How to measure whether a model-backed system is good enough, whether a change made it better, and whether it is still good on live traffic.'
weight = 15
+++

An evaluation is the test suite of a system with a probabilistic component. It
only works if it can detect the change you care about, if its grader agrees
with the people whose judgment it stands in for, and if it keeps running after
release.

The three lessons cover designing offline evals with honest error bars and
enough statistical power, using a model as a grader and measuring its bias and
calibration against humans, and evaluating on live traffic with A/B tests,
interleaving, and guardrail metrics. Afterwards you can size an eval set for a
target effect, correct a judge's pass rate for its known errors, and design an
online experiment that does not fool you.
