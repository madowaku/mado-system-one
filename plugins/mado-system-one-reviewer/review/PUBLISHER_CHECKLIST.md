# Publisher checklist

Human gates must remain visibly incomplete until verified.

- [ ] Submitter has Apps Management write access in the publishing OpenAI Platform organization.
- [ ] Developer or business identity is verified in that organization.
- [ ] Verified publisher identity matches `author.name` and `interface.developerName`.
- [ ] If the public publisher name is not `madowaku`, both manifest fields are updated before submission.
- [ ] Production-ready logo is prepared for the portal.
- [ ] Countries/regions are selected only where publication and support are ready.
- [ ] Final skill package passes the portal safety/security scan.
- [ ] All starter prompts are exercised against the final package.
- [ ] Five positive fixtures reproduce expected behavior.
- [ ] Three negative fixtures demonstrate non-activation or safe fallback.
- [ ] Release notes are accurate.
- [ ] Final policy attestations are reviewed and confirmed by the publisher.

## Optional public URLs

For the current skills-only ZIP route, website, support, privacy, and terms URLs are optional under the documented rules.

If supplied, they must be public HTTPS URLs, match the verified publisher, and accurately describe the real product and data handling.
