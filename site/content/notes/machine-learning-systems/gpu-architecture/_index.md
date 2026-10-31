+++
title = 'GPU architecture'
description = 'What is inside a modern data-center GPU: streaming multiprocessors, warps, the memory hierarchy, and tensor cores with their number formats.'
weight = 3
+++

A GPU trades the latency tricks of a CPU for thousands of simple lanes and a
very wide path to memory. This module builds the mental model the rest of the
course leans on: the roofline that says whether a kernel is limited by
arithmetic or by bytes, how a streaming multiprocessor schedules warps, how far
each level of memory is from the arithmetic, and what tensor cores and low
precision formats actually buy.

Afterwards you should be able to take a spec sheet and a kernel's FLOP and byte
counts and say which resource bounds it, how much latency the chip must hide,
and what precision is safe for which part of the computation.
