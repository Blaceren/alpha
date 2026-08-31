Records of prune runs, kept as history.

Each file names releases that were removed and the active/anchor pair that was
protected at the time. They are additive: the protocol writes the record BEFORE
anything is removed, so a record exists even for a prune that then refused.
