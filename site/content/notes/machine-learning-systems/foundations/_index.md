+++
title = 'Foundations'
description = 'The mathematics every training run repeats: tensors and their shapes, gradients by backpropagation, the optimizers that use them, and how to tell learning from memorizing.'
weight = 1
+++

A training run is four ideas repeated billions of times. Data and weights are
**tensors** whose shapes decide memory and arithmetic. **Backpropagation**
computes the gradient of the loss with respect to every weight for about twice
the cost of the forward pass. An **optimizer** turns gradients into updates,
and its learning rate decides whether training converges or diverges. And
**validation** tells you whether the model learned something general or only
memorized its training set.

Each lesson builds one of these from scratch in standard-library Python.
Afterwards you should be able to read a layer as shapes and bytes, explain
where the factor of 6 in "6ND" training compute comes from, choose and debug a
learning-rate schedule, and read a train/validation curve.
