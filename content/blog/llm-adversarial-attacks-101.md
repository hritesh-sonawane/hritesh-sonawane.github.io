---
external: false
title: "Adversarial Attacks on LLMs"
description: "Adversarial Attacks on LLMs"
date: 2024-05-07
---

Large Language Models (LLMs) have revolutionized the field of Natural Language Processing (NLP), enabling applications like text generation, language translation, and question answering. Adversarial attacks on LLMs aim to manipulate or deceive the model's output, posing significant threats to their reliability and trustworthiness.

## Threat Model

Adversarial attacks on LLMs can be launched by various actors, including malicious users, nation-states, or even other AI systems. The threat model includes attacks aimed at compromising the confidentiality, integrity, or availability of LLMs, as well as using LLMs as a vector for attacks on other systems or infrastructure.

![llm threat model](https://i.imgur.com/sH1rKrZ.png)
Fig. 1: An overview of threats to LLM-based applications. (Image source: [Greshake et al. 2023](https://arxiv.org/abs/2302.12173))

### Classification

Adversarial attacks on LLMs can be classified into two main categories: white-box and black-box attacks. White-box attacks involve direct access to the model's architecture and parameters, while black-box attacks rely on input-output interactions with the model.

### Text Generation

LLMs generate text based on input prompts or initial text. Adversarial attacks can manipulate the input or the model's parameters to produce malicious or misleading output.

### White-box vs Black-box

White-box attacks require access to the model's internal workings, allowing attackers to craft targeted attacks. Black-box attacks, on the other hand, rely on trial and error, making them more feasible for real-world scenarios.

## Types of Adversarial Attacks

| Attack                | Type      | Description                                                                                  |
|-----------------------|-----------|----------------------------------------------------------------------------------------------|
| Token manipulation    | Black-box | Alter a small fraction of tokens in the text input such that it triggers model failure but still remains its original semantic meanings. |
| Gradient based attack | White-box | Rely on gradient signals to learn an effective attack.                                       |
| Jailbreak prompting   | Black-box | Often heuristic-based prompting to “jailbreak” built-in model safety.                          |
| Human red-teaming     | Black-box | Human attacks the model, with or without assist from other models.                            |
| Model red-teaming     | Black-box | Model attacks the model, where the attacker model can be fine-tuned.                         |


- Token manipulation involves modifying input tokens to deceive the model. This can be done by inserting, deleting, or replacing tokens.
- Gradient-based attacks use the model's gradients to identify vulnerabilities and craft targeted attacks.
- Humans in the loop red-teaming involves using human evaluators to test the model's robustness.
- Model red-teaming involves using other models to test the target model's robustness.
- Jailbreak prompting involves crafting input prompts that bypass the model's security mechanisms.

![image info](https://i.imgur.com/ukA2BSl.png)
Fig. 2: The pipeline of red-teaming via Explore-Establish-Exploit steps. (Image source: [Casper et al. 2023](https://arxiv.org/abs/2306.09442))

## Mitigations

Mitigation strategies include:
- Saddle point problem
    - The saddle point problem involves finding the optimal solution that balances the model's performance and robustness.
- LLM robustness techniques
    - Research has focused on developing robust LLMs, including techniques like adversarial training and input preprocessing.

## References
1. Weng, Lilian. “[Adversarial Attacks on LLMs](https://lilianweng.github.io/posts/2023-10-25-adv-attack-llm)”. Lil’Log (Oct 2023).
2. Greshake et al. “[Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection.](https://arxiv.org/abs/2302.12173)” arXiv preprint arXiv:2302.12173 (2023).
3. Casper et al. “[Explore, Establish, Exploit: Red Teaming Language Models from Scratch.](https://arxiv.org/abs/2306.09442)” arXiv preprint arXiv:2306.09442 (2023).