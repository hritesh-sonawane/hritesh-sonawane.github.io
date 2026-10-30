+++
title = 'Untrusted input'
description = 'Input becomes dangerous when a program interprets it instead of storing it. This module covers injection, cross-site scripting, server-side request forgery, unsafe parsers and deserializers, and file paths.'
weight = 4
+++

Every vulnerability in this module has the same shape. A value arrives from
outside, the application hands it to something that interprets text (a SQL
engine, a shell, a browser, a URL fetcher, a deserializer, the file system),
and the value changes what that interpreter does. The attacker never breaks a
lock. They write a sentence in a language the application did not realize it
was speaking.

The five lessons take one interpreter at a time: SQL and the shell, the
browser, outbound HTTP, parsers and object deserializers, and paths and
archives. Each one shows the vulnerable code running against a simulated
target, the fix that removes the ambiguity rather than filtering for bad
characters, and where that fix stops working. By the end you should be able to
look at any place where input meets an interpreter and say **which part of the
input is data, which part could become structure, and what keeps them apart**.
