"""Tile x day x day/night x satellite table used to fit and validate harmonization -> interim/tileday_dn.parquet"""
from config import INTERIM
from validate import tileday
if __name__ == "__main__":
    tileday().write_parquet(INTERIM / "tileday_dn.parquet"); print("tileday_dn.parquet written")
