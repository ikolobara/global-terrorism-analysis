import pandas as pd

INPUT = "data/terrorism.csv"
OUTPUT = "data/terrorism_clean.csv"

df = pd.read_csv(
    INPUT,
    encoding="latin1",
    low_memory=False
)

df_clean = pd.DataFrame({
    "year": df["iyear"],
    "country": df["country_txt"],
    "region": df["region_txt"],
    "city": df["city"],
    "lat": df["latitude"],
    "lon": df["longitude"],
    "attackType": df["attacktype1_txt"],
    "kills": df["nkill"],
    "wounded": df["nwound"],
    "organization": df["gname"]
})

# ukloni redove bez koordinata
df_clean = df_clean.dropna(subset=["lat", "lon"])

# zamijeni NaN
df_clean["kills"] = df_clean["kills"].fillna(0)
df_clean["wounded"] = df_clean["wounded"].fillna(0)

# ukloni Unknown organizacije
df_clean["organization"] = (
    df_clean["organization"]
    .fillna("Unknown")
)

df_clean.to_csv(
    OUTPUT,
    index=False,
    encoding="utf-8"
)

print(df_clean.shape)
print("Spremljeno:", OUTPUT)