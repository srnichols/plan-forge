# parser.py — fixture: Python parser with leaf functions
# Caller edges: (none — parse_record is a leaf called by make_fixture in helpers.py)


def parse_record(data):
    """
    Parse a raw record dict into a normalized form.

    Parameters
    ----------
    data : dict
        Input record.

    Returns
    -------
    dict
        Normalized record.
    """
    if not isinstance(data, dict):
        raise TypeError("Expected dict")
    return {
        "id": str(data.get("id", "")),
        "value": data.get("value"),
        "normalized": True,
    }


def validate_record(record):
    """
    Validate a normalized record has the required keys.

    Parameters
    ----------
    record : dict
        Record to validate.

    Returns
    -------
    bool
        True if valid, False otherwise.
    """
    required = {"id", "value", "normalized"}
    return required.issubset(record.keys())


def format_output(records):
    """
    Format a list of records into a summary string.

    Parameters
    ----------
    records : list[dict]
        List of records to format.

    Returns
    -------
    str
        Human-readable summary.
    """
    lines = [f"  [{r['id']}] = {r['value']}" for r in records]
    return "Records:\n" + "\n".join(lines)
