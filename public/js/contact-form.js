document.addEventListener('DOMContentLoaded', function () {
  var fileInput = document.getElementById('contactFormAttachment');
  var pickBtn = document.getElementById('contactAttachmentPick');
  var listEl = document.querySelector('.contact-attachment-list');
  var statusEl = document.querySelector('.contact-attachment-status');
  var hiddenInp = document.querySelector('.contact-attachment-urls');
  var submitBtn = document.querySelector('.contact-form-content input[type="submit"]');
  var uploads = []; // {id, file, status:'pending'|'uploading'|'done'|'error', url}
  var activeUploads = 0;

  function setSubmitDisabled(disabled) {
    if (submitBtn) {
      submitBtn.disabled = disabled;
      submitBtn.style.cursor = disabled ? 'not-allowed' : 'pointer';
      submitBtn.style.opacity = disabled ? '0.6' : '1';
    }
  }

  function updateHiddenInput() {
    var urls = uploads
      .filter(function (u) {
        return u.status === 'done' && u.url;
      })
      .map(function (u) {
        return u.url;
      });
    if (hiddenInp) hiddenInp.value = JSON.stringify(urls);
    if (statusEl) {
      if (urls.length === 0) statusEl.textContent = 'No attachments selected.';
      else statusEl.textContent = urls.length + ' attachment(s) ready.';
    }
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    uploads.forEach(function (item, idx) {
      var li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.justifyContent = 'space-between';
      li.style.gap = '8px';

      var left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '10px';

      var name = document.createElement('div');
      name.textContent = item.file.name;
      name.style.fontSize = '13px';
      name.style.color = '#222';

      var small = document.createElement('div');
      small.style.fontSize = '12px';
      small.style.color = '#666';
      small.textContent =
        item.status === 'uploading'
          ? 'Uploading...'
          : item.status === 'done'
          ? 'Uploaded'
          : item.status === 'error'
          ? 'Error'
          : 'Pending';

      left.appendChild(name);
      left.appendChild(small);

      var controls = document.createElement('div');
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.style.padding = '6px 8px';
      removeBtn.style.border = '1px solid #ddd';
      removeBtn.style.background = '#fff';
      removeBtn.style.cursor = 'pointer';
      removeBtn.addEventListener('click', function () {
        if (item.status === 'uploading') return alert('Please wait until the upload finishes');
        uploads.splice(idx, 1);
        updateHiddenInput();
        renderList();
      });

      controls.appendChild(removeBtn);
      li.appendChild(left);
      li.appendChild(controls);
      listEl.appendChild(li);
    });
  }

  function uploadFile(item) {
    if (!item || !item.file) return Promise.reject(new Error('No file provided'));
    if (typeof UPLOADCARE_PUBLIC_KEY === 'undefined' || !UPLOADCARE_PUBLIC_KEY) {
      item.status = 'error';
      renderList();
      return Promise.reject(new Error('UploadCare key not present'));
    }

    item.status = 'uploading';
    activeUploads++;
    setSubmitDisabled(true);
    renderList();

    var fd = new FormData();
    fd.append('UPLOADCARE_PUB_KEY', UPLOADCARE_PUBLIC_KEY);
    fd.append('UPLOADCARE_STORE', 'auto');
    fd.append('file', item.file, item.file.name);

    return fetch('https://upload.uploadcare.com/base/', { method: 'POST', body: fd })
      .then(function (resp) {
        if (!resp.ok) throw new Error('Upload service returned ' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        if (!json || !json.file) throw new Error('Invalid upload response');
        // Use the reliable CDN URL pattern from UploadCare
        item.url = 'https://ucarecdn.com/' + json.file + '/';
        item.status = 'done';
        activeUploads--;
        if (activeUploads <= 0) setSubmitDisabled(false);
        updateHiddenInput();
        renderList();
        return item.url;
      })
      .catch(function (err) {
        item.status = 'error';
        activeUploads--;
        if (activeUploads <= 0) setSubmitDisabled(false);
        updateHiddenInput();
        renderList();
        throw err;
      });
  }

  if (!fileInput || !pickBtn) {
    // If inputs are missing, nothing to wire up for file uploads
    return;
  }

  pickBtn.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    if (!files.length) return;
    var maxBytes = 10 * 1024 * 1024;
    files.forEach(function (f) {
      if (f.size > maxBytes) {
        alert('File "' + f.name + '" is too large (max 10 MB).');
        return;
      }
      var id = Math.random().toString(36).slice(2, 9);
      var entry = { id: id, file: f, status: 'pending', url: '' };
      uploads.push(entry);
      renderList();
      // start upload immediately
      uploadFile(entry).catch(function (err) {
        console.error('Upload error', err);
        if (statusEl) statusEl.textContent = 'Some uploads failed.';
      });
    });
  });

  // Handle form submit: send to backend email API instead of Shopify default
  var formEl = document.querySelector('.contact-form-content form');
  if (formEl) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Check if any uploads are still in progress
      var working = uploads.some(function (u) {
        return u.status === 'uploading';
      });
      if (working) {
        alert('Please wait for attachments to finish uploading before submitting.');
        return false;
      }

      // Collect form data
      var nameInp = document.getElementById('contactFormName');
      var emailInp = document.getElementById('contactFormEmail');
      var phoneInp = document.getElementById('contactFormPhone');
      var messageInp = document.getElementById('contactFormMessage');

      var name = nameInp ? nameInp.value.trim() : '';
      var email = emailInp ? emailInp.value.trim() : '';
      var phone = phoneInp ? phoneInp.value.trim() : '';
      var message = messageInp ? messageInp.value.trim() : '';

      if (!name || !email || !message) {
        alert('Please fill in all required fields.');
        return false;
      }

      // Prepare FormData for backend email API
      var emailFormData = new FormData();
      emailFormData.append('to', 'contact@loretana.com'); // recipient (or read from config)
      emailFormData.append('senderEmail', email); // from contact form
      emailFormData.append('subject', 'Contact Form Submission from ' + name);
      emailFormData.append(
        'text',
        'Name: ' +
          name +
          '\nEmail: ' +
          email +
          '\nPhone: ' +
          phone +
          '\n\nMessage:\n' +
          message
      );

      // Build HTML version with better formatting
      var htmlBody =
        '<p><strong>Name:</strong> ' +
        escapeHtml(name) +
        '</p>' +
        '<p><strong>Email:</strong> ' +
        escapeHtml(email) +
        '</p>' +
        '<p><strong>Phone:</strong> ' +
        escapeHtml(phone) +
        '</p>' +
        '<p><strong>Message:</strong></p>' +
        '<p>' +
        escapeHtml(message).replace(/\n/g, '<br/>') +
        '</p>';

      // Add uploaded attachment URLs (as links in email since backend sends CDN URLs, not binary files)
      var uploadedUrls = uploads
        .filter(function (u) {
          return u.status === 'done' && u.url;
        })
        .map(function (u) {
          return u.url;
        });

      if (uploadedUrls.length > 0) {
        htmlBody += '<p><strong>Attachments:</strong></p><ul>';
        uploadedUrls.forEach(function (url) {
          htmlBody += '<li><a href="' + url + '">' + url + '</a></li>';
        });
        htmlBody += '</ul>';
      }

      emailFormData.append('html', htmlBody);

      // Disable submit button during send
      setSubmitDisabled(true);
      if (statusEl) {
        statusEl.textContent = 'Sending email...';
        statusEl.style.color = '#333';
      }

      // POST to backend email API
      var endpoint = 'https://loretana-backend.vercel.app/email/send';
      fetch(endpoint, {
        method: 'POST',
        body: emailFormData,
      })
        .then(function (resp) {
          // Try to parse JSON even on non-OK responses
          return resp
            .json()
            .catch(function () {
              // If not JSON, return text
              return resp.text().then(function (t) {
                return { success: false, message: t || 'Unknown error', status: resp.status };
              });
            })
            .then(function (json) {
              return { ok: resp.ok, status: resp.status, body: json };
            });
        })
        .then(function (result) {
          setSubmitDisabled(false);
          if (result.ok && result.body && result.body.success) {
            alert('Thank you! Your message has been sent successfully.');
            // Reset form
            formEl.reset();
            if (fileInput) fileInput.value = '';
            uploads = [];
            renderList();
            updateHiddenInput();
            if (statusEl) {
              statusEl.textContent = 'Email sent. Message cleared.';
              statusEl.style.color = '#2b8a3e';
            }
          } else {
            var msg =
              (result.body && (result.body.message || JSON.stringify(result.body))) ||
              'Failed to send email';
            alert('Error: ' + msg);
            if (statusEl) {
              statusEl.textContent = 'Send failed. Please try again.';
              statusEl.style.color = '#cc3b3b';
            }
            console.error('Send error', result.status, result.body);
          }
        })
        .catch(function (err) {
          setSubmitDisabled(false);
          console.error('Email send error', err);
          alert('Error sending email. Please try again later.');
          if (statusEl) {
            statusEl.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
            statusEl.style.color = '#cc3b3b';
          }
        });

      return false;
    });
  }

  // Helper: escape HTML entities for safe display in email
  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function (c) {
      return map[c];
    });
  }

  // initial render
  renderList();
  updateHiddenInput();
});
