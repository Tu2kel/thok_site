(function () {
  // ═══════════════════════════════════════════════════════════════════════
  //  IMPERIO SCC — MEMO GENERATOR TAB
  //  Imperial Ivory theme · Cinzel + Cormorant Garamond
  //  Pre-compiled React · No Babel · No JSX
  // ═══════════════════════════════════════════════════════════════════════

  const {
    createElement: hM,
    useState:      useMState,
    useEffect:     useMEffect,
    useRef:        useMRef,
  } = React;

  // ── Ivory theme tokens ───────────────────────────────────────────────
  const IV = {
    canvas:    '#faf7f2',
    sheen:     'linear-gradient(160deg,#ffffff 0%,#f8f4ed 18%,#eee9df 40%,#f5f1ea 60%,#fdfaf5 80%,#f8f5ef 100%)',
    border:    'rgba(201,168,76,.38)',
    bodyColor: '#1a0a12',
    bodyDim:   'rgba(26,10,18,.65)',
    bodyFaint: 'rgba(26,10,18,.38)',
    goldSolid: '#7a5000',
    goldGrad:  'linear-gradient(to bottom,#8a5c00 22%,#b8860b 45%,#9a6800 50%,#7a5000 55%,#b8860b 78%)',
    goldDim:   'rgba(120,80,0,.65)',
    goldRule:  'rgba(160,110,0,.35)',
    goldRuleB: 'rgba(160,110,0,.5)',
  };

  const DIVIDER_TOKEN = '\n---DIV---\n';

  // ── Render body text → HTML with gold dividers ───────────────────────
  function renderBodyHTML(raw) {
    if (!raw.trim()) return '';
    const segments = raw.split('---DIV---');
    let html = '';
    segments.forEach((seg, i) => {
      const paras = seg.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      paras.forEach(para => {
        html += '<p style="font-family:\'Cormorant Garamond\',serif;font-size:16px;line-height:1.85;color:'
          + IV.bodyColor + ';margin-bottom:13px;letter-spacing:.02em;text-align:justify;">'
          + para.replace(/\n/g, '<br>') + '</p>';
      });
      if (i < segments.length - 1) {
        html += '<div style="position:relative;height:1px;background:linear-gradient(90deg,transparent,'
          + IV.goldRuleB + ' 20%,' + IV.goldRuleB + ' 80%,transparent);margin:20px 0;">'
          + '<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
          + 'font-size:7px;color:' + IV.goldSolid + ';background:rgba(250,247,242,.9);padding:0 10px;line-height:1;">◆</span>'
          + '</div>';
      }
    });
    return html;
  }

  // ── Memo Page — printable preview ────────────────────────────────────
  function MemoPage({ to, re, date, bodyHTML }) {
    return hM('div', {
      id: 'memo-page',
      style: {
        maxWidth: '700px',
        margin: '0 auto',
        border: '1px solid rgba(160,110,0,.22)',
        borderRadius: '3px',
        padding: '30px 34px 38px',
        background: 'rgba(255,255,255,.45)',
        boxShadow: '0 0 0 4px rgba(201,168,76,.06),0 2px 24px rgba(160,110,0,.07)',
      }
    },

      // ── Letterhead ──────────────────────────────────────────────────
      hM('div', {
        style: {
          background: IV.sheen,
          border: '1px solid ' + IV.border,
          borderRadius: '4px',
          padding: '20px 24px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '18px',
        }
      },
        // Top gloss line
        hM('div', { style: { position:'absolute',top:0,left:0,right:0,height:'1px',background:'linear-gradient(90deg,transparent,rgba(201,168,76,.4) 30%,rgba(160,110,0,.7) 50%,rgba(201,168,76,.4) 70%,transparent)' } }),

        // Left — wordmark
        hM('div', { style: { display:'flex',alignItems:'center',gap:'14px' } },
          hM('div', null,
            hM('span', { style: { fontFamily:'Cinzel,serif',fontSize:'25px',fontWeight:'900',letterSpacing:'.2em',background:IV.goldGrad,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',display:'block' } }, 'IMPERIO'),
            hM('span', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'10.5px',fontStyle:'italic',letterSpacing:'.14em',color:IV.bodyDim,display:'block',marginTop:'4px' } }, 'Talent Solutions · A Division of The House of Kel LLC'),
          ),
        ),

        // Right — contact
        hM('div', { style: { textAlign:'right',flexShrink:'0' } },
          hM('span', { style: { fontFamily:'Cinzel,serif',fontSize:'11.5px',fontWeight:'600',letterSpacing:'.08em',color:IV.goldSolid,display:'block',marginBottom:'2px' } }, 'Anthony K. Kelley Sr.'),
          hM('span', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'11px',color:IV.bodyDim,display:'block',marginBottom:'2px' } }, 'Founder & CEO'),
          hM('span', { style: { fontFamily:'Cinzel,serif',fontSize:'7.5px',letterSpacing:'.14em',color:IV.goldDim,display:'block' } }, '(254) 226-5216 · anthony@imperiovita.co'),
          hM('div', { style: { display:'flex',gap:'5px',justifyContent:'flex-end',marginTop:'7px',flexWrap:'wrap' } },
            ...['SDVOSB','CAGE 152U4','VetHUB','CMBL'].map(cert =>
              hM('span', { key: cert, style: { fontFamily:'Cinzel,serif',fontSize:'6.5px',letterSpacing:'.14em',textTransform:'uppercase',padding:'2px 7px',border:'1px solid rgba(160,110,0,.38)',color:IV.goldSolid,borderRadius:'1px',background:'rgba(201,168,76,.05)' } }, cert)
            )
          ),
        ),

        // Bottom rule
        hM('div', { style: { position:'absolute',bottom:0,left:'24px',right:'24px',height:'1px',background:'linear-gradient(90deg,transparent,' + IV.goldRule + ' 20%,' + IV.goldRule + ' 80%,transparent)' } },
          hM('span', { style: { position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',fontSize:'6px',color:IV.goldSolid,background:'#f5f1ea',padding:'0 7px',lineHeight:'1' } }, '◆')
        ),
      ),

      // ── Meta block ──────────────────────────────────────────────────
      hM('div', { style: { padding:'14px 0 0' } },
        hM('div', { style: { display:'grid',gridTemplateColumns:'46px 1fr',gap:'4px 14px',alignItems:'baseline',padding:'13px 16px',background:'rgba(201,168,76,.04)',border:'1px solid rgba(160,110,0,.14)',borderRadius:'3px' } },
          ...[ ['Date',to && 'Date',date], ['To',null,to], ['From',null,'Anthony K. Kelley Sr., Founder & CEO — Imperio Talent Solutions'], ['Re',null,re] ]
            .map(([lbl,,]) => lbl).filter((v,i,a) => a.indexOf(v) === i)
            .flatMap(lbl => {
              const val = lbl === 'Date' ? date : lbl === 'To' ? to : lbl === 'From' ? 'Anthony K. Kelley Sr., Founder & CEO — Imperio Talent Solutions' : re;
              return [
                hM('span', { key: lbl+'L', style: { fontFamily:'Cinzel,serif',fontSize:'7px',letterSpacing:'.2em',textTransform:'uppercase',color:IV.goldDim,whiteSpace:'nowrap',paddingTop:'2px' } }, lbl),
                hM('span', { key: lbl+'V', style: { fontFamily:'Cormorant Garamond,serif',fontSize:'13.5px',color:IV.bodyColor,letterSpacing:'.02em' } }, val || '—'),
              ];
            })
        ),
        hM('div', { style: { height:'1px',background:IV.goldRule,margin:'12px 0 0' } }),
      ),

      // ── Body ────────────────────────────────────────────────────────
      hM('div', {
        style: { padding:'22px 0 0' },
        dangerouslySetInnerHTML: {
          __html: bodyHTML || '<p style="font-family:\'Cormorant Garamond\',serif;font-size:16px;color:rgba(26,10,18,.28);font-style:italic;">Begin typing in the editor panel…</p>'
        },
      }),

      // ── Signature ───────────────────────────────────────────────────
      hM('div', { style: { marginTop:'28px',paddingTop:'20px',borderTop:'1px solid ' + IV.goldRule } },
        hM('div', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'15px',fontStyle:'italic',color:IV.bodyDim,marginBottom:'14px' } }, 'Respectfully,'),
        hM('div', { style: { fontFamily:'Cinzel,serif',fontSize:'13px',fontWeight:'700',letterSpacing:'.1em',color:IV.goldSolid,marginBottom:'3px' } }, 'Anthony K. Kelley Sr.'),
        hM('div', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'12px',color:IV.bodyDim,marginBottom:'2px',letterSpacing:'.05em' } }, 'Founder & CEO — Imperio Talent Solutions'),
        hM('div', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'12px',color:IV.bodyDim,marginBottom:'2px',letterSpacing:'.05em' } }, 'A Division of The House of Kel LLC'),
        hM('div', { style: { fontFamily:'Cinzel,serif',fontSize:'7.5px',letterSpacing:'.18em',color:IV.goldDim,marginTop:'6px' } }, 'SDVOSB · CAGE 152U4 · (254) 226-5216 · anthony@imperiovita.co'),
      ),

      // ── Footer ──────────────────────────────────────────────────────
      hM('div', { style: { marginTop:'32px',paddingTop:'13px',borderTop:'1px solid rgba(160,110,0,.22)',display:'flex',justifyContent:'space-between',alignItems:'center' } },
        hM('span', { style: { fontFamily:'Cormorant Garamond,serif',fontSize:'10px',fontStyle:'italic',color:IV.bodyFaint,letterSpacing:'.06em' } }, 'Imperio Talent Solutions · The House of Kel LLC'),
        hM('span', { style: { fontFamily:'Cinzel,serif',fontSize:'7px',letterSpacing:'.2em',textTransform:'uppercase',color:IV.goldDim } }, 'SDVOSB · CAGE 152U4 · Killeen, Texas'),
      ),
    );
  }

  // ── MEMO TAB ROOT ────────────────────────────────────────────────────
  function MemoTab() {
    const [to,   setTo]   = useMState('');
    const [re,   setRe]   = useMState('');
    const [date, setDate] = useMState(() =>
      new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
    );
    const [body, setBody] = useMState('');
    const bodyRef = useMRef(null);

    const bodyHTML = renderBodyHTML(body);

    const insertDivider = () => {
      const ta = bodyRef.current;
      if (!ta) return;
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      const before = v.substring(0, s).replace(/\n*$/, '\n');
      const after  = v.substring(e).replace(/^\n*/, '\n');
      setBody(before + DIVIDER_TOKEN + after);
      setTimeout(() => {
        ta.focus();
        const pos = before.length + DIVIDER_TOKEN.length;
        ta.setSelectionRange(pos, pos);
      }, 0);
    };

    const handlePrint = () => window.print();

    const handleClear = () => {
      if (!confirm('Clear memo?')) return;
      setTo(''); setRe(''); setBody('');
      setDate(new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }));
    };

    // Inject print styles once
    useMEffect(() => {
      if (document.getElementById('memo-print-style')) return;
      const s = document.createElement('style');
      s.id = 'memo-print-style';
      s.textContent = `
        @media print {
          @page { size: letter; margin: .5in .6in; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          #imp-sb, nav, .tabs, .brand, .brand-sub, .divider,
          #memo-editor-panel, .theme-toggle-btn { display: none !important; }
          body { padding-left: 0 !important; background: #faf7f2 !important; }
          main { padding: 0 !important; overflow: visible !important; }
          #memo-tab-root { overflow: visible !important; height: auto !important; }
          #memo-preview-panel {
            padding: 0 !important;
            background: #faf7f2 !important;
            background-image: none !important;
            overflow: visible !important;
            flex: unset !important;
            height: auto !important;
            width: 100% !important;
          }
          #memo-preview-panel > div {
            overflow: visible !important;
            height: auto !important;
          }
          #memo-page {
            box-shadow: none !important;
            max-width: 100% !important;
            padding: 26px 30px 34px !important;
            border: 1px solid rgba(160,110,0,.22) !important;
            background: rgba(255,255,255,.45) !important;
          }
        }
      `;
      document.head.appendChild(s);
    }, []);

    const inp = {
      width: '100%',
      background: 'rgba(255,255,255,.05)',
      border: '1px solid rgba(201,168,76,.2)',
      borderRadius: '2px',
      color: '#f5f0e8',
      fontFamily: 'Cormorant Garamond,serif',
      fontSize: '15px',
      padding: '7px 10px',
      outline: 'none',
      boxSizing: 'border-box',
    };
    const lbl = {
      fontFamily: 'Cinzel,serif',
      fontSize: '7.5px',
      letterSpacing: '.28em',
      textTransform: 'uppercase',
      color: 'rgba(201,168,76,.6)',
      display: 'block',
      marginBottom: '4px',
    };

    return hM('div', {
      id: 'memo-tab-root',
      style: { display:'flex', height:'calc(100vh - 56px)', overflow:'hidden', animation:'fadeUp .4s ease both' }
    },

      // ══ LEFT EDITOR ═══════════════════════════════════════════════
      hM('div', {
        id: 'memo-editor-panel',
        style: {
          width: '300px',
          flexShrink: '0',
          background: 'linear-gradient(160deg,#2e2b32 0%,#1a1820 18%,#0e0d10 40%,#161418 60%,#1f1d23 80%,#111012 100%)',
          borderRight: '1px solid rgba(201,168,76,.15)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 16px',
          gap: '10px',
          overflowY: 'auto',
        }
      },

        // Panel title
        hM('div', { style: { marginBottom:'4px' } },
          hM('div', { style: { fontFamily:'Cinzel,serif',fontSize:'9px',letterSpacing:'.22em',textTransform:'uppercase',color:'rgba(201,168,76,.4)',marginBottom:'4px' } }, '◆ Memo Generator'),
          hM('div', { style: { fontFamily:'Cinzel,serif',fontSize:'16px',letterSpacing:'.08em',background:'linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text' } }, 'Compose Memo'),
        ),

        // Fields
        hM('div', null, hM('label', { style: lbl }, 'To'), hM('input', { style: inp, value: to, placeholder:'Recipient', onChange: e => setTo(e.target.value) })),
        hM('div', null, hM('label', { style: lbl }, 'Re'), hM('input', { style: inp, value: re, placeholder:'Subject / Re:', onChange: e => setRe(e.target.value) })),
        hM('div', null, hM('label', { style: lbl }, 'Date'), hM('input', { style: inp, value: date, placeholder:'Date', onChange: e => setDate(e.target.value) })),

        hM('div', { style: { height:'1px',background:'rgba(201,168,76,.1)',margin:'2px 0' } }),

        hM('label', { style: lbl }, 'Body'),
        hM('textarea', {
          ref: bodyRef,
          value: body,
          onChange: e => setBody(e.target.value),
          placeholder: 'Type memo content…\n\nUse the button below to insert a gold section divider at the cursor.',
          style: { ...inp, flex:'1', minHeight:'220px', resize:'none', lineHeight:'1.7' },
        }),

        // Divider insert
        hM('button', {
          onClick: insertDivider,
          style: { background:'transparent',border:'1px solid rgba(201,168,76,.3)',color:'rgba(201,168,76,.7)',fontFamily:'Cinzel,serif',fontSize:'7.5px',letterSpacing:'.2em',textTransform:'uppercase',padding:'9px 10px',cursor:'pointer',borderRadius:'2px',transition:'all .2s',textAlign:'center' },
          onMouseEnter: e => { e.target.style.background='rgba(0,0,0,.3)'; e.target.style.borderColor='rgba(201,168,76,.6)'; e.target.style.color='#C9A84C'; },
          onMouseLeave: e => { e.target.style.background='transparent'; e.target.style.borderColor='rgba(201,168,76,.3)'; e.target.style.color='rgba(201,168,76,.7)'; },
        }, '◆   Insert Gold Divider'),

        hM('div', { style: { height:'1px',background:'rgba(201,168,76,.1)',margin:'2px 0' } }),

        // Print
        hM('button', {
          onClick: handlePrint,
          style: { background:'linear-gradient(to bottom,#cf972d 22%,#f9f295 45%,#e0aa3e 50%,#b8860b 55%,#f9f295 78%)',border:'none',color:'#2a1000',fontFamily:'Cinzel,serif',fontSize:'7.5px',letterSpacing:'.22em',textTransform:'uppercase',fontWeight:'700',padding:'11px 10px',cursor:'pointer',borderRadius:'2px',transition:'opacity .2s' },
          onMouseEnter: e => e.target.style.opacity='.85',
          onMouseLeave: e => e.target.style.opacity='1',
        }, '⎙   Print / Save PDF'),

        // Clear
        hM('button', {
          onClick: handleClear,
          style: { background:'transparent',border:'1px solid rgba(201,168,76,.1)',color:'rgba(201,168,76,.28)',fontFamily:'Cinzel,serif',fontSize:'7px',letterSpacing:'.18em',textTransform:'uppercase',padding:'6px 10px',cursor:'pointer',borderRadius:'2px',transition:'all .2s' },
          onMouseEnter: e => { e.target.style.borderColor='rgba(231,76,60,.3)'; e.target.style.color='rgba(231,76,60,.55)'; },
          onMouseLeave: e => { e.target.style.borderColor='rgba(201,168,76,.1)'; e.target.style.color='rgba(201,168,76,.28)'; },
        }, 'Clear'),
      ),

      // ══ RIGHT PREVIEW ══════════════════════════════════════════════
      hM('div', {
        id: 'memo-preview-panel',
        style: {
          flex: '1',
          backgroundColor: IV.canvas,
          backgroundImage: 'radial-gradient(ellipse at 15% 0%,rgba(201,168,76,.18) 0%,transparent 55%),radial-gradient(ellipse at 85% 100%,rgba(201,168,76,.11) 0%,transparent 50%)',
          padding: '36px 28px 56px',
          overflowY: 'auto',
        }
      },
        hM(MemoPage, { to, re, date, bodyHTML }),
      ),
    );
  }

  window.SCC_TABS = window.SCC_TABS || {};
  window.SCC_TABS.MemoTab = MemoTab;
})();
