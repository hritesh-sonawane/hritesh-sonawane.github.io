+++
title = 'GPU performance'
description = 'How GPU code is written and made fast: the CUDA programming model, coalesced access and occupancy, tiling, fusion and IO-aware kernels, and reading a profiler.'
weight = 4
+++

The architecture module said what the hardware can do. This module is about
getting a kernel close to it. It starts with how work is mapped onto grids,
blocks, and threads, then covers the patterns that decide most kernel
performance: coalesced memory access, enough resident warps, tiling for reuse,
and fusing operations so intermediate results never touch HBM. It ends with
reading a profiler report to find which of these is the problem.

Each lesson counts the bytes and transactions with a short Python program, so
you can check a kernel design on paper before writing it.
