"""Streamlit UI. Run with: streamlit run app.py"""
import streamlit as st

st.set_page_config(page_title="Resilience Rewired", layout="wide")
st.title("Resilience Rewired")
st.caption("Tangerine track, Sheridan Datathon 2026")

account_id = st.number_input("Account ID", min_value=0, step=1)
st.info("Engine not wired yet. See README.md for the plan.")
