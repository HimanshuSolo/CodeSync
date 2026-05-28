use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret:   String,
    pub groq_api_key: String,
    pub host:         String,
    pub port:         u16,
}

impl Config {
    /// Load config from environment variables.
    /// Panics early if any required variable is missing —
    /// better to crash at startup than fail at runtime.
    pub fn from_env() -> Self {
        Self {
            database_url: required("DATABASE_URL"),
            jwt_secret:   required("JWT_SECRET"),
            groq_api_key: required("GROQ_API_KEY"),
            host:         env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port:         env::var("PORT")
                            .unwrap_or_else(|_| "8080".to_string())
                            .parse()
                            .expect("PORT must be a valid number"),
        }
    }
}

fn required(key: &str) -> String {
    env::var(key).unwrap_or_else(|_| panic!("Missing required env var: {key}"))
}