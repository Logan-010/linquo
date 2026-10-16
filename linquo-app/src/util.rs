pub fn errstr<E: ToString>(e: E) -> String {
    e.to_string()
}
