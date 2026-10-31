+++
title = 'Retrieval'
description = 'Finding the right passages for a model to read: embeddings and approximate nearest-neighbor indexes, chunking and hybrid search with reranking, and measuring whether retrieval works.'
weight = 11
+++

Most answers that look like a model failure are retrieval failures: the right
passage was never ingested, was split in half, or was ranked eleventh when only
ten were sent. This module treats retrieval as the search system it is.

The first lesson covers embeddings and the approximate nearest-neighbor indexes
that search them (IVF, product quantization, HNSW) with their recall, latency,
and memory tradeoffs at 100 million vectors. The second covers chunking, keyword
and vector search, how to fuse them, and where a reranker earns its latency.
The third covers evaluation: recall, MRR, and nDCG, how many queries a
comparison needs, the bias of incomplete judgments, and why retrieval recall
caps answer quality. Afterwards you should be able to size a vector index,
choose its parameters from a recall target, and prove that a retrieval change
helped.
