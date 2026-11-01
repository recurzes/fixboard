import phonenumbers
from phonenumbers import PhoneNumberFormat, ValidationResult


def normalize_phone(raw: str) -> str:
    """Parses a US number into E.164. The ValueError never includes the input, it is personal."""
    try:
        number = phonenumbers.parse(raw, "US")
    except phonenumbers.NumberParseException:
        raise ValueError("Invalid US phone number") from None

    # Not is_valid_number, which rejects the 555 numbers. Not is_possible_number either,
    # which accepts seven digits with no area code.
    reason = phonenumbers.is_possible_number_with_reason(number)
    e164 = phonenumbers.format_number(number, PhoneNumberFormat.E164)
    # US area codes never start with 0 or 1, which also rejects (000) 000-0000.
    if number.country_code != 1 or reason != ValidationResult.IS_POSSIBLE or e164[2] in "01":
        raise ValueError("Invalid US phone number")
    return e164
