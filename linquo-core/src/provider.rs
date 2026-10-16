//! Connect to an LLM provider through the rig registry.
//!
//! Use [`connect`] to obtain a completion model that can be passed to
//! [`crate::generation::Generator::new`].

use rig::{
    DynModel,
    client::EnvError,
    operation::Completion,
    providers::registry::{self, ConnectError, ProviderRef, RefError},
};
use std::str::FromStr;
use thiserror::Error;

/// Errors that can occur while connecting to a provider.
#[derive(Error, Debug)]
pub enum Error {
    /// The provider reference was invalid or unknown.
    #[error(transparent)]
    Ref(#[from] RefError),
    /// A required environment variable was missing or invalid.
    #[error(transparent)]
    Env(#[from] EnvError),
    /// The connection to the provider failed.
    #[error(transparent)]
    Connect(#[from] ConnectError),
}

/// Connect to a completion model from the rig provider registry.
///
/// `provider` is a provider reference string (e.g. `"openai:gpt-4o"`).
/// If `credentials` is `Some`, it is passed directly as the API key;
/// otherwise the provider is resolved from the environment.
pub async fn connect(
    provider: &str,
    credentials: Option<&str>,
) -> Result<DynModel<Completion>, Error> {
    match credentials {
        Some(c) => Ok(registry::connect(provider, c)?),
        None => Ok(ProviderRef::from_str(provider)?.completion_model()?),
    }
}
