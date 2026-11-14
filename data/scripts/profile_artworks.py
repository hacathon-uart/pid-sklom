"""Step 0 of the AI approach: image -> «meme profile». Owner: A, review: C — T12.

For each artwork without meme_profile: send the image + backend/app/ai/prompts.PROFILE to the
vision LLM, parse JSON {description, mood, tags, situations}, write back to the seed / DB.
A person then checks each profile for 10–20 seconds (plan §4).

    python data/scripts/profile_artworks.py [--only-missing]
"""

raise SystemExit("TODO: not implemented yet (T12)")
