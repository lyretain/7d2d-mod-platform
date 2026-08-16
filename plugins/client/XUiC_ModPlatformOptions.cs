using ModPlatform.Shared;

public sealed class XUiC_ModPlatformOptions : XUiC_OptionsDialogBase
{
    XUiC_TextInput txtBaseUrl;
    XUiC_ComboBoxBool cbxAutoSync;
    XUiC_ComboBoxBool cbxAutoRestart;
    XUiC_ComboBoxBool cbxDiagnostics;
    bool loaded;

    public override void Init()
    {
        base.Init();
        txtBaseUrl = GetChildById("txtBaseUrl") as XUiC_TextInput;
        cbxAutoSync = GetChildById("cbxAutoSync") as XUiC_ComboBoxBool;
        cbxAutoRestart = GetChildById("cbxAutoRestart") as XUiC_ComboBoxBool;
        cbxDiagnostics = GetChildById("cbxDiagnostics") as XUiC_ComboBoxBool;
        if (txtBaseUrl != null) txtBaseUrl.OnChangeHandler += OnTextChanged;
        if (cbxAutoSync != null) cbxAutoSync.OnValueChanged += OnBoolChanged;
        if (cbxAutoRestart != null) cbxAutoRestart.OnValueChanged += OnBoolChanged;
        if (cbxDiagnostics != null) cbxDiagnostics.OnValueChanged += OnBoolChanged;
    }

    public override void OnOpen()
    {
        base.OnOpen();
        LoadFromConfig();
    }

    public override bool GetBindingValueInternal(ref string value, string bindingName)
    {
        switch (bindingName)
        {
            case "support_defaults":
                value = "true";
                return true;
            case "plugin_version":
                value = "v" + PluginIdentity.PluginVersion;
                return true;
            case "pack_status":
                value = ModPlatformClientPlugin.PackStatusText();
                return true;
            default:
                return base.GetBindingValueInternal(ref value, bindingName);
        }
    }

    public override void doSaveChangesInternal()
    {
        ModPlatformClientPlugin.ApplyFromUi(ReadBaseUrl(), ReadBool(cbxAutoSync, true), ReadBool(cbxAutoRestart, true), ReadBool(cbxDiagnostics, true));
    }

    public override void doResetToDefaultsInternal()
    {
        loaded = false;
        if (txtBaseUrl != null) txtBaseUrl.Text = "https://mods.aic.la";
        if (cbxAutoSync != null) cbxAutoSync.Value = true;
        if (cbxAutoRestart != null) cbxAutoRestart.Value = true;
        if (cbxDiagnostics != null) cbxDiagnostics.Value = true;
        loaded = true;
        SetChanged();
    }

    public override void doDiscardChangesInternal()
    {
        LoadFromConfig();
    }

    void OnTextChanged(XUiController sender, string text, bool changeFromCode)
    {
        if (!loaded || changeFromCode) return;
        SetChanged();
    }

    void OnBoolChanged(XUiController sender, bool oldValue, bool newValue)
    {
        if (!loaded) return;
        SetChanged();
    }

    void LoadFromConfig()
    {
        var current = ModPlatformClientPlugin.CurrentConfig();
        loaded = false;
        if (txtBaseUrl != null) txtBaseUrl.Text = string.IsNullOrEmpty(current.BaseUrl) ? "https://mods.aic.la" : current.BaseUrl;
        if (cbxAutoSync != null) cbxAutoSync.Value = current.ShouldSync;
        if (cbxAutoRestart != null) cbxAutoRestart.Value = current.ShouldRestart;
        if (cbxDiagnostics != null) cbxDiagnostics.Value = current.DiagnosticsEnabled;
        loaded = true;
        UnsavedChanges = false;
        RefreshBindings();
    }

    string ReadBaseUrl()
    {
        return txtBaseUrl == null ? "" : txtBaseUrl.Text;
    }

    static bool ReadBool(XUiC_ComboBoxBool box, bool fallback)
    {
        return box == null ? fallback : box.Value;
    }
}
