use rig::{
    DynModel,
    client::EnvError,
    operation::Completion,
    providers::registry::{self, ConnectError, ProviderRef, RefError},
};
use std::str::FromStr;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    Ref(#[from] RefError),
    #[error(transparent)]
    Env(#[from] EnvError),
    #[error(transparent)]
    Connect(#[from] ConnectError),
}

pub async fn connect(
    provider: &str,
    credentials: Option<&str>,
) -> Result<DynModel<Completion>, Error> {
    match credentials {
        Some(c) => Ok(registry::connect(provider, c)?),
        None => Ok(ProviderRef::from_str(provider)?.completion_model()?),
    }
}
