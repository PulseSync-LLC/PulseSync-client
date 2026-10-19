use std::time::Duration;
use ureq::unversioned::{
    resolver::DefaultResolver,
    transport::{Buffers, ConnectionDetails, Connector, DefaultConnector, NextTimeout, Transport},
};

pub fn http_agent(connect_timeout: Duration, read_timeout: Duration) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(connect_timeout))
        .build();
    ureq::Agent::with_parts(
        config,
        ReadTimeoutConnector {
            inner: DefaultConnector::default(),
            timeout: read_timeout,
        },
        DefaultResolver::default(),
    )
}

#[derive(Debug)]
struct ReadTimeoutConnector {
    inner: DefaultConnector,
    timeout: Duration,
}

impl Connector for ReadTimeoutConnector {
    type Out = ReadTimeoutTransport;

    fn connect(
        &self,
        details: &ConnectionDetails,
        chained: Option<()>,
    ) -> std::result::Result<Option<Self::Out>, ureq::Error> {
        Ok(self
            .inner
            .connect(details, chained)?
            .map(|inner| ReadTimeoutTransport {
                inner,
                timeout: self.timeout,
            }))
    }
}

#[derive(Debug)]
struct ReadTimeoutTransport {
    inner: Box<dyn Transport>,
    timeout: Duration,
}

impl Transport for ReadTimeoutTransport {
    fn buffers(&mut self) -> &mut dyn Buffers {
        self.inner.buffers()
    }

    fn transmit_output(
        &mut self,
        amount: usize,
        timeout: NextTimeout,
    ) -> std::result::Result<(), ureq::Error> {
        self.inner.transmit_output(amount, timeout)
    }

    fn await_input(&mut self, mut timeout: NextTimeout) -> std::result::Result<bool, ureq::Error> {
        // Bound each blocking read; recv_body would limit the entire download.
        if timeout.after > self.timeout.into() {
            timeout.after = self.timeout.into();
            timeout.reason = ureq::Timeout::RecvBody;
        }
        self.inner.await_input(timeout)
    }

    fn is_open(&mut self) -> bool {
        self.inner.is_open()
    }

    fn is_tls(&self) -> bool {
        self.inner.is_tls()
    }
}
