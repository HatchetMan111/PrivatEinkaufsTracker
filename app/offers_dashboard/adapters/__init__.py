"""Quellen-Adapter."""

from .base import Location, RawOffer, Retailer
from .kaufda import KaufdaAdapter
from .marktguru import MarktguruAdapter

__all__ = ["KaufdaAdapter", "Location", "MarktguruAdapter", "RawOffer", "Retailer"]
