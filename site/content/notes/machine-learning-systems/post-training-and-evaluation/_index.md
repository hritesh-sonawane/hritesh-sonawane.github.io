+++
title = 'Post-training and evaluation'
description = 'Adapting a pretrained model with fine-tuning and LoRA, aligning it with preference data, and measuring the result without fooling yourself.'
weight = 7
+++

Pretraining produces a model that continues text. Post-training turns it into
something useful: supervised fine-tuning on demonstrations, then preference
optimization so it prefers the answers people prefer. Both are cheap compared
with pretraining, and both are easy to get subtly wrong.

This module works through the arithmetic of full fine-tuning against LoRA, the
loss behind RLHF and DPO, and the ways benchmark numbers mislead, starting with
test data that leaked into training.
