use std::{io, ops::{Deref, DerefMut}, process::{Child, Command}};

// A job outlives the launcher PID, so grandchildren are still reclaimed when a
// Node launcher exits before its native Codex process.
#[cfg(windows)]
struct ProcessJob(isize);

#[cfg(windows)]
impl ProcessJob {
    fn new() -> io::Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() { return Err(io::Error::last_os_error()); }
        let job = Self(handle as isize);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe { SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
    fn assign(&self, child: &Child) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        if unsafe { windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(self.0 as _, child.as_raw_handle() as _) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    fn terminate(&self) {
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0 as _, 1); }
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _); } }
}

pub struct OwnedChild {
    child: Child,
    #[cfg(windows)]
    job: ProcessJob,
}

impl OwnedChild {
    pub fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        let job = ProcessJob::new()?;
        let child = command.spawn()?;
        #[cfg(windows)]
        if let Err(error) = job.assign(&child) {
            let mut child = child;
            let _ = child.kill();
            // try_wait never blocks; callers must never inherit an unowned child.
            for _ in 0..20 {
                if matches!(child.try_wait(), Ok(Some(_))) { break; }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            return Err(error);
        }
        Ok(Self { child, #[cfg(windows)] job })
    }
    pub fn terminate_tree(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.kill();
    }
}

impl Deref for OwnedChild { type Target = Child; fn deref(&self) -> &Child { &self.child } }
impl DerefMut for OwnedChild { fn deref_mut(&mut self) -> &mut Child { &mut self.child } }
