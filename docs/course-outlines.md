# Course outlines (fixed slugs)

Source of truth for module and lesson slugs, so lessons can cross-link before
the files exist. Paths are under `site/content/notes/`. User decision
2026-10-30: combine courses where possible — three new courses, and
observability folded into systems design.

## New courses

### 6. `machine-learning-systems` — Machine learning systems (ML, GPUs, training)

1. `foundations`: `01-tensors-and-shapes`, `02-gradients-and-backpropagation`, `03-optimizers-and-learning-rates`, `04-generalization-and-overfitting`
2. `transformers`: `01-embeddings-and-tokenization`, `02-attention-from-scratch`, `03-the-transformer-block`, `04-scaling-laws-and-compute`
3. `gpu-architecture`: `01-why-gpus-and-the-roofline`, `02-sms-warps-and-simt`, `03-the-memory-hierarchy`, `04-tensor-cores-and-number-formats`
4. `gpu-performance`: `01-the-programming-model`, `02-coalescing-and-occupancy`, `03-tiling-a-matmul`, `04-fusion-and-io-aware-kernels`, `05-profiling-gpu-code`
5. `training-at-scale`: `01-data-pipelines`, `02-mixed-precision-and-stability`, `03-data-parallelism-and-all-reduce`, `04-zero-and-fsdp`, `05-tensor-and-pipeline-parallelism`, `06-checkpoints-and-failures`
6. `clusters-and-hardware`: `01-nvlink-pcie-and-topology`, `02-collectives-and-networking`, `03-sharing-gpus`, `04-the-accelerator-landscape`
7. `post-training-and-evaluation`: `01-fine-tuning-and-lora`, `02-preference-optimization`, `03-evaluation-and-contamination`

### 7. `inference-engineering` — Inference engineering (includes vLLM)

1. `inference-mechanics`: `01-prefill-and-decode`, `02-kv-cache-math`, `03-why-decode-is-memory-bound`
2. `batching-and-scheduling`: `01-continuous-batching`, `02-paged-kv-memory`, `03-chunked-prefill-and-priority`
3. `making-it-cheaper`: `01-quantization`, `02-speculative-decoding`, `03-prefix-caching`
4. `serving-systems`: `01-anatomy-of-a-serving-engine`, `02-choosing-a-stack`, `03-streaming-apis`
5. `vllm-internals`: `01-the-request-path`, `02-the-scheduler`, `03-the-kv-cache-manager`, `04-model-execution`, `05-operating-vllm`
6. `distributed-inference`: `01-tensor-pipeline-and-expert-parallelism`, `02-disaggregated-prefill-and-decode`, `03-serving-mixture-of-experts`
7. `production-inference`: `01-latency-slos-and-goodput`, `02-capacity-planning`, `03-autoscaling-and-model-loading`, `04-multi-tenancy-and-fairness`

### 8. AI system design — merged into `systems-design` as modules 9–16 on 2026-10-30 (`worked-designs` became `ai-worked-designs`)

1. `how-ai-systems-differ`: `01-what-changes-with-a-model`, `02-cost-latency-and-quality`
2. `model-interfaces`: `01-tokens-context-and-cost`, `02-structured-output-and-tool-calls`, `03-prompts-as-versioned-code`
3. `retrieval`: `01-embeddings-and-ann-search`, `02-chunking-and-hybrid-search`, `03-evaluating-retrieval`
4. `building-blocks`: `01-gateways-and-routers`, `02-caches`, `03-queues-and-batch-lanes`, `04-evaluation-services`
5. `ai-infrastructure`: `01-a-training-cluster`, `02-a-data-platform`, `03-an-inference-platform`, `04-gpu-scheduling`
6. `agentic-systems`: `01-the-agent-loop`, `02-memory-and-planning`, `03-durable-execution`, `04-tools-permissions-and-approval`
7. `evaluation-in-production`: `01-designing-evals`, `02-model-graders`, `03-online-evaluation`
8. `worked-designs`: `01-a-chat-assistant-at-scale`, `02-retrieval-over-private-documents`, `03-a-coding-agent-platform`, `04-a-batch-inference-pipeline`, `05-an-evaluation-platform`

## Modules appended to existing courses

- `systems-design/scale-and-performance` (module 6): `01-queueing-and-littles-law`, `02-caching`, `03-partitioning-and-sharding`, `04-load-balancing-and-tail-latency`, `05-profiling-a-slow-service`
- `systems-design/distributed-data` (module 7): `01-consensus-and-raft`, `02-storage-engines`, `03-logs-and-stream-processing`, `04-distributed-transactions`
- `systems-design/observability` (module 8): `01-metrics-cardinality-and-histograms`, `02-tracing-and-profiling`, `03-sampling-cost-and-alerting`, `04-observing-ai-infrastructure`
- `ai-security-engineering/frontier-model-security` (module 6): `01-securing-model-weights`, `02-research-and-training-infrastructure`, `03-insider-risk-and-model-access`, `04-extraction-and-distillation`, `05-capability-evaluations-and-release-gates`, `06-confidential-inference`
- `infrastructure-security/securing-gpu-clusters` (module 6): `01-multi-tenant-gpu-isolation`, `02-schedulers-and-fabrics`, `03-storage-and-checkpoints`

Totals: 84 lessons in new courses, 22 in appended modules.
