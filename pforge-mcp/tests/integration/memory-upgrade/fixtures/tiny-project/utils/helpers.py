# helpers.py — fixture: Python utility functions
# Caller edges: make_fixture → parse_record


def parse_record(data):
    """
    Parse a raw data record into a normalized dict.

    Parameters
    ----------
    data : dict
        Raw record to normalize.

    Returns
    -------
    dict
        Normalized record with 'id' and 'value' keys.
    """
    if not isinstance(data, dict):
        raise TypeError("data must be a dict")
    return {
        "id": str(data.get("id", "")),
        "value": data.get("value", None),
        "normalized": True,
    }


def make_fixture(n):
    """
    Build a list of n fixture records, each passed through parse_record.

    Parameters
    ----------
    n : int
        Number of records to generate.

    Returns
    -------
    list[dict]
        List of normalized fixture records.
    """
    records = []
    for i in range(n):
        raw = {"id": i, "value": i * 10}
        records.append(parse_record(raw))
    return records
