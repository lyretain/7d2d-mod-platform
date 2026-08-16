using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ModPlatform.Shared
{
    public sealed class PlatformClient : IDisposable
    {
        private readonly HttpClient http;
        private readonly string baseUrl;

        public PlatformClient(string baseUrl)
        {
            this.baseUrl = baseUrl.TrimEnd('/');
            http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        }

        public async Task<ServerAssignment> GetAssignmentAsync(string serverId, string token, CancellationToken cancellationToken)
        {
            using (var request = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/api/v1/servers/" + Uri.EscapeDataString(serverId) + "/assignment"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using (var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    response.EnsureSuccessStatusCode();
                    using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        return Deserialize<ServerAssignment>(stream);
                }
            }
        }

        public async Task SubmitHandshakeAsync(string address, IList<string> playerIds, HandshakeHello hello, CancellationToken cancellationToken)
        {
            var body = new HandshakeSubmit
            {
                Address = address,
                PlayerIds = playerIds == null ? new List<string>() : new List<string>(playerIds),
                Hello = hello
            };
            using (var content = new StringContent(Serialize(body), Encoding.UTF8, "application/json"))
            using (var response = await http.PostAsync(baseUrl + "/api/v1/public/handshakes", content, cancellationToken).ConfigureAwait(false))
                response.EnsureSuccessStatusCode();
        }

        public async Task<HandshakeHello> ClaimHandshakeAsync(string serverId, string token, IList<string> playerIds, CancellationToken cancellationToken)
        {
            using (var request = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/v1/servers/" + Uri.EscapeDataString(serverId) + "/pending-handshake/claim"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Content = new StringContent(Serialize(new HandshakeClaimRequest
                {
                    PlayerIds = playerIds == null ? new List<string>() : new List<string>(playerIds)
                }), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
                    response.EnsureSuccessStatusCode();
                    using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    {
                        var result = Deserialize<HandshakeClaimResult>(stream);
                        return result == null ? null : result.Hello;
                    }
                }
            }
        }

        public async Task SendDiagnosticAsync(DiagnosticEvent value, CancellationToken cancellationToken)
        {
            var json = Serialize(value);
            using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
            using (var response = await http.PostAsync(baseUrl + "/api/v1/diagnostics", content, cancellationToken).ConfigureAwait(false))
                response.EnsureSuccessStatusCode();
        }

        public async Task SendSyncStatusAsync(string serverId, string token, ServerSyncStatus status, CancellationToken cancellationToken)
        {
            using (var request = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/api/v1/servers/" + Uri.EscapeDataString(serverId) + "/sync-status"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Content = new StringContent(Serialize(status), Encoding.UTF8, "application/json");
                using (var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                    response.EnsureSuccessStatusCode();
            }
        }

        public static string Serialize<T>(T value)
        {
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        public static T Deserialize<T>(Stream stream)
        {
            return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }

        public void Dispose() { http.Dispose(); }
    }
}
