# PRMPTR Speech Benchmark

This directory is the executable accuracy/evidence surface for speech changes.

## Run

```bash
npm run speech:benchmark
npm run speech:benchmark -- --manifest benchmarks/speech/fixtures/smoke-manifest.json --output speech-result.json
npm run speech:benchmark -- --max-wer 0.08 --max-speaker-confusion 0.10
npm run speech:benchmark:compare -- --baseline before.json --candidate after.json
npm run speech:benchmark:test
```

The evaluator prints a human summary and can emit machine-readable JSON. The comparison command is the regression gate: it compares two retained result JSON files and exits non-zero when accuracy, diarization, duplicate-channel behavior, p95 latency/inference time, or dropped-sample limits regress.

Default comparison tolerances are deliberately tight: +1 percentage point WER/CER, +2 points technical-term/speaker-confusion/duplicate-channel rate, +75 ms p95 latency/inference, and **zero dropped samples**. Qualification runs may override a threshold explicitly, but the override belongs in retained evidence rather than being hidden in code.

## Manifest contract

Each case contains a `reference` transcript and an engine-produced `hypothesis`. Optional fields add evidence for technical terms, speaker assignments, latency, inference duration, realtime factor, duplicate cross-channel rate, and dropped samples. The evaluator reports aggregate WER/CER, technical-term error, first/last-word clipping, speaker-word confusion, latency/inference p50+p95, mean realtime factor, duplicate rate, and dropped samples.

`referenceSpeakers` / `hypothesisSpeakers` use ordered `{ speaker, text }` segments. Speaker-word confusion is intentionally named as a proxy metric rather than full diarization error rate (DER); a proper time-weighted DER scorer belongs with the real timestamped corpus.

The checked-in `contract-smoke` fixture validates evaluator behavior and protects intentional short utterances such as `you`, `the`, and `thank you`. It is **not** model-quality evidence. Real qualification manifests must point at retained/captured engine outputs and record engine/model/config metadata.

## Corpus rules

Real corpus inputs should cover clean and noisy microphones, compressed call audio, quiet/fast/accented speech, technical names and identifiers, 2/3/5 speakers, rapid turns, overlap, music/game background audio, short utterances, and dual mic/system leakage. Raw recordings should not be committed if licensing/privacy is unclear; use deterministic retained paths or hashes and document acquisition separately.
