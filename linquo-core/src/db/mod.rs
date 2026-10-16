//! SQLite-backed persistence for lessons and key-value settings.
//!
//! The main entry point is the [`Database`] handle, created via
//! [`Database::new`]. It runs schema migrations on connect and exposes
//! methods for storing lessons/exercises and a simple key-value store.

mod connect;
use connect::connect;

mod types;
pub use types::*;

mod queries;
