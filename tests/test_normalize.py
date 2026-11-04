from offers_dashboard.normalize import match_key, normalize_name, unit_key


def test_normalize_lowercases_and_replaces_umlauts():
    assert normalize_name("Käse Müller") == "kaese mueller"


def test_normalize_removes_packaging_quantities():
    assert normalize_name("Toilettenpapier Soft je 250-g-Packg.") == "toilettenpapier soft"
    assert normalize_name("Cola 12 x 330 ml") == "cola"
    assert normalize_name("Brot 1-kg-Stück") == "brot"


def test_normalize_removes_punctuation():
    assert normalize_name("Kaffee, gemahlen!") == "kaffee gemahlen"


def test_unit_key_combines_quantity_and_unit():
    assert unit_key("kg", 1.0) == "1kg"
    assert unit_key(None, None) == ""


def test_match_key_is_stable_and_retailer_specific():
    first = match_key(1, "Marke", "Produkt", "1kg")
    second = match_key(1, "Marke", "Produkt", "1kg")
    other = match_key(2, "Marke", "Produkt", "1kg")
    assert first == second
    assert first != other
