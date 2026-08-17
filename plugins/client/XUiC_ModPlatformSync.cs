using ModPlatform.Shared;

public sealed class XUiC_ModPlatformSync : XUiController
{
    public override void Update(float _dt)
    {
        base.Update(_dt);
        RefreshBindings();
    }

    public override bool GetBindingValueInternal(ref string value, string bindingName)
    {
        switch (bindingName)
        {
            case "title":
                value = ModPlatformClientPlugin.SyncUiTitle();
                return true;
            case "subtitle":
                value = ModPlatformClientPlugin.SyncUiSubtitle();
                return true;
            case "status":
                value = ModPlatformClientPlugin.SyncUiStatus();
                return true;
            case "bytes":
                value = ModPlatformClientPlugin.SyncUiBytes();
                return true;
            case "progress":
                value = ModPlatformClientPlugin.SyncUiProgressFill();
                return true;
            default:
                return base.GetBindingValueInternal(ref value, bindingName);
        }
    }
}
