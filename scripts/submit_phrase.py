"""Pure helpers for spoken submit-command cleanup."""

import re


def strip_trailing_submit_phrase(text, phrase):
    """Remove only a trailing command, case-insensitively, with punctuation."""
    pattern = rf"(?:[\s,;:.!?—-]+|^){re.escape(phrase)}[\s,;:.!?—-]*$"
    cleaned, count = re.subn(pattern, "", text, flags=re.IGNORECASE)
    return cleaned.rstrip(), count > 0
