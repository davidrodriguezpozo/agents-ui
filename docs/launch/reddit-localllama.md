# r/LocalLLaMA — recommend NOT posting

**Verdict: skip this one.**

r/LocalLLaMA is about running models on your own hardware. Agents Studio runs locally
but the inference does not — it's Claude-only, through a hosted API, behind a paid
login. "Fully local" in the old draft was the kind of half-true that gets picked apart in
the comments, and the honest version ("local UI, cloud model, subscription required") is
squarely off-topic for that subreddit. Expect downvotes or removal, and a thread arguing
about the title rather than the product.

If you want the CLI-savvy-developer audience that overlaps with it, these are better
targets for the same effort:

| Where | Why | Watch out for |
| --- | --- | --- |
| **r/ClaudeCode** | Exactly the audience. Smaller than r/ClaudeAI but far higher intent. | Reuse the r/ClaudeAI post; trim the explanation of what worktrees are. |
| **lobste.rs** | Rewards the kind of writing already in the README. | Invite-only, and self-promotion needs to be a minority of your submissions. Only if you have an account. |
| **r/devtools**, **r/selfhosted** | Self-hosted local-first tooling lands well; the loopback-binding and no-telemetry story is the hook for r/selfhosted. | r/selfhosted may object that the model isn't self-hosted. Lead with "local dashboard for a cloud model" and don't overclaim. |

If you post to r/LocalLLaMA anyway, the only framing that survives contact is an
architecture question rather than a launch — "here's how I structured worktree-isolated
agent sessions, the model layer is swappable" — and that's a different post, worth
writing only if the swappable model layer is real.

See [reddit-other.md](reddit-other.md) for the short cross-post body.
